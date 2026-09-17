# Serviço local de reconhecimento de cartas Pokémon (Python + ONNX)

Pipeline forte de duas rotas rodando na máquina do usuário (`127.0.0.1:8765`), consumido pelo site com fallback automático para o pipeline do navegador (v11) quando offline.

**Regra de projeto nº 1: OCR nunca é gatekeeper.** A rota visual identifica a carta mesmo quando o OCR lê lixo (ex.: "escia" numa carta Shroodle). Regressões obrigatórias em `tests/test_units.py` + fixtures.

## Arquitetura

```
foto ──► normalização (quad-contour / Hough / aspect-fallback, 600×840)
          │
          ├── ROTA A (visual): embedding SigLIP2-base-384 multi-view
          │   (0°/180° × raw/gamma-auto) → índice local → Top-50
          │   → verificação SIFT+RANSAC homografia (região da arte)
          │
          ├── ROTA B (texto): PP-OCRv6 medium por regiões
          │   (nome/HP/número/denominador/set) → hints → catálogo
          │
          └── memória confirmada (exemplares aprovados pelo usuário)
                  │
FUSÃO ──► verificação geométrica ~conclusiva + similaridade global calibrada
          por modelo + validação de metadados OCR → decisão honesta:
          IDENTIFICADO / PROVÁVEL / REVISAR / NAO_IDENTIFICADO
```

- **Normalização**: múltiplas estratégias de binarização (Canny+CLAHE, Otsu, threshold adaptativo) com pontuação de plausibilidade ponderando área (quad interno brilhante nunca vence o contorno da carta); rotações 0/90/180/270; par 0°/180° ambíguo resolvido por max de similaridade e OCR.
- **Retrieval**: busca bruta por cosseno (12–80k cartas cabem em RAM; mais rápido e exato que ANN aproximado nesse porte). Query multi-view: vistas gamma-auto resgatam fotos escuras/lavadas sem prejudicar fotos boas (máximo por carta).
- **Verificação**: SIFT + RANSAC; inliers ≥ 12 e razão ≥ 0,30 = evidência quase-conclusiva. A pontuação privilegia a região da arte — molduras compartilhadas (Trainer/Item) não dominam o match.
- **OCR**: PP-OCRv6 medium (det+rec) por regiões com confiança por leitura. Número do colecionador lido em até 4 regiões complementares (canto completo; banda larga 72–100% completa; banda larga esq-60%; banda baixa esq-60%) com escada de denoising (raw → bilateral → Otsu). O early-stop exige **consenso**: o mesmo N/M lido duas vezes (entre regiões/preprocessamentos) — uma leitura única, por mais confiante, não encerra a escada, porque uma leitura isolada errada é exatamente o que a votação existe para derrotar. Banda "name2" (14–32%) resgata o nome em warps frouxos.
- **Reprints**: quando a arte é praticamente idêntica e número/set/rodapé estão ilegíveis, o sistema entrega o nome correto + candidatos e decide `PROVÁVEL`/`REVISAR` — nunca inventa a impressão exata. O **número completo N/M** é evidência de fusão independente: contradição de N (confiança ≥ 0,75) vira veto (-70×conf) e teta em `PROVÁVEL`; contradição de M com mesmo N (`106/189` fotografado vs `106/73` impresso) é a assinatura de reprint de outro set — mesma penalidade e mesmo teto. Com M legível, o print exato vence; sem leitura confiável, nada é vetado.
- **Memória**: apenas confirmação explícita do usuário cria exemplares (ground truth); predições nunca são auto-salvas. O lookup exige similaridade ≥ `MEMORY_MIN_SIMILARITY` **e** margem sobre o melhor exemplar de carta DIFERENTE (calibrados por `scripts/benchmark_memory.py`; a distribuição de impostores do SigLIP2 — mediana ≈ 0,886, p95 ≈ 0,940 — torna qualquer threshold ~0,80 inseguro). Memória é evidência AUXILIAR: nunca produz `IDENTIFICADO` sozinha e não infla a similaridade visual.

## Bake-off de embeddings (2026-09-14, mini-índice adversarial)

Cenário: 12 fixtures (5 falhas hard restantes + 5 normais + 2 reprints), mini-índice com as cartas-verdade + confusores reais do índice completo + 500 distratores aleatórios.

Ranks das 5 falhas hard `[rand-028, rand-055, rand-077, rand-078, rand-086]`:

| Modelo | hard ranks | reprints | observação |
|---|---|---|---|
| dinov3-vits16@224 (anterior) | 286 / 12 / 118 / 45 / 49 | 2 / 2 | perdia por degradação fotométrica |
| dinov2-small@224 | 169 / 4 / 57 / 10 / 5 | 5 / 2 | sims baixos, rank razoável |
| dinov3-vitb16@224 | 86 / 1 / 154 / 1 / 55 | 3 / 2 | resolve 2 de 5 |
| dinov3-vits16@392 | 42 / 1 / 2 / 1 / 7 | 1 / 1 | resolução ajuda, custo alto |
| **siglip2-base-384** | **2 / 1 / 1 / 1 / 1** | 1 / 2 | vencedor claro |
| **siglip2 + query gamma-auto** | **1 / 1 / 1 / 1 / 1** | 1 / 2 | Top-1 11/12; único restante é reprint sem evidência |

Sondas: CLAHE/gray-world/percentile-stretch puras não salvam o DINOv3; artwork-crop resgata DINOv3 (118→1) mas **piora** SigLIP2 no caso lavado (rank 263). Conclusão: SigLIP2 full-card + query multi-view (raw + gamma-auto).

Causas diagnosticadas nas falhas restantes: **D** degradação fotométrica extrema (brilho 22–32, 75% pixels escuros; contraste lavado 15) → resolvida por gamma-auto; **E** reprint com arte idêntica (`swsh4.5-30` vs `swsh1-64`, margem 0,005) → permanece honestamente em `PROVÁVEL`/`REVISAR`.

## Benchmarks (fixtures sintéticas, n=106, CPU 2 núcleos do sandbox)

| Método | Top-1 | Top-5 | Falso alta conf. | Latência média |
|---|---|---|---|---|
| OCR-gatekeeper (arquitetura antiga, emulada) | 3,8% | 7,5% | 25,5% | ~5031 ms |
| Rota visual dinov3-vits16 | 92,5% | 95,3% | 0,94% | ~257 ms |
| Híbrido dinov3-vits16+SIFT+OCR (baseline) | 93,4% | 95,3% | 0,00% | ~4379 ms |
| Rota visual siglip2 (retrieval puro, índice completo) | 90,6% | 97,2% | 0,00% | ~2984 ms |
| **Híbrido siglip2+SIFT+OCR (atual)** | **97,2%** | **98,1%** | **0,00%** | ~17238 ms |

Híbrido atual (n=106 fixtures sintéticas, índice pt-BR completo com 12.744 cartas — 100% do catálogo —, CPU 2 núcleos do sandbox): Top-3 = 98,1%; name 99,1%; set 97,2%; idioma 100%; identified 83,0%; p95 24060 ms. A latência subiu vs. a rodada anterior porque o OCR de número agora percorre múltiplas regiões com variantes de denoising (early-stop em leitura confiável mantém scans limpos em 1 passe); em máquina Windows com GPU (DirectML/CUDA) a latência cai fortemente.

Falhas Top-1 restantes (3/106), todas com decisão honesta:
- 1 reprint de arte idêntica (`sv07-107` vs `sv08.5-070` Archaludon) → `REVISAR` com o par de candidatos certo. Sem leitura de número/set, força de evidência não existe — não se inventa exact match. O caso Frosmoth (`swsh4.5-30` vs `swsh1-64`) foi RESOLVIDO nesta rodada: o OCR multi-região lê o número com confiança suficiente e o veto de contradição destrona o reprint.
- 2 fotos com degradação fotométrica extrema (65%+ pixels quase pretos; `rand-028` Porygon2, `rand-085` Shedinja) → `NAO_IDENTIFICADO`. Sondei vista CLAHE adicional: melhora um caso (rank 34→10) sem alcançar Top-5 e piora o outro — rejeitada (custo +50% de latência, sem ganho de decisão).

Correções de fusão desta rodada (regressões cobertas em `tests/test_units.py`):
- Leitura truncada de nome (`CaudaBrado?`) não favorece mais a carta de nome curto (`Cauda Brado`) sobre a variante (`Cauda Brado ex`) — contenção espaço-insensível trata ambas como compatíveis; verificação geométrica e número discriminam.
- Banner de categoria no frame (`TREINADOR`, `ITEM`, ...) não é mais tratado como nome de carta (eliminava -90 da carta correta).

Reprodução:

```bash
python scripts/make_fixtures.py            # regenera fixtures sintéticas dos scans
python scripts/benchmark.py --methods hybrid-siglip2-base-384+sift --out data/benchmark-after.json
```

Fotos reais: colocar em `data/fixtures-real/` + `ground-truth.json` (mesmo formato) e rodar `benchmark.py --fixtures data/fixtures-real`. **Benchmarks sintético e real são reportados separadamente — nunca somados.**

### Splits sem vazamento de dados

As fixtures sintéticas são degradações dos próprios scans oficiais que o índice embute — servem como **benchmark de regressão**, não como estimativa independente de precisão. Para não calibrar e medir no mesmo conjunto:

```bash
python scripts/split_fixtures.py                 # split determinístico por cardId (disjunto por carta)
python scripts/calibrate_thresholds.py --split calibration   # calibra SÓ no split de calibração
python scripts/benchmark.py --split validation               # reporta no split de validação
```

São três conjuntos disjuntos por `cardId` (gêmeos pt/en caem juntos no mesmo split): `calibration` (60%) → calibrar thresholds; `validation` (25%) → métrica sintética honesta; `heldout` (15%) → reserva. `--split all` mantém a comparabilidade com rodadas antigas (regressão ponta-a-ponta).

### Holdout real (ainda não disponível)

As 7 fotos de desenvolvimento acima foram usadas para achar os bugs — não são benchmark cego. O próximo passo de medição é um conjunto **holdout** de 30–100 fotos novas, nunca usado para tuning: crie `data/holdout/` com as fotos + `ground-truth.json` no mesmo formato (photo, cardId, language, tags: idioma/holo/glare/sleeve/perspectiva/rotação/reprint) e rode `benchmark.py --fixtures data/holdout`. O manifest fica local (fotos privadas não entram no git). Até existir, reporte "quase 100%" apenas para o dev set — o holdout é a fonte da estimativa cega.


## Validação em fotos reais (2026-09-15, WhatsApp)

7 fotos reais de celular (JPEG comprimido, carta em suporte plástico, ângulo, glare, fundo escuro com pelúcia) — todas pt-BR — **7/7 identificadas corretamente** com evidência nome + número + verificação geométrica:

| Carta | Impressão correta | Decisão |
|---|---|---|
| Purrloin | `swsh3-106` 106/189 Escuridão Incandescente | IDENTIFICADO |
| Rayquaza | `me02.5-153` 153/217 Heróis Excelsos | IDENTIFICADO |
| Shroodle | `sv08-120` 120/191 Fagulhas Impetuosas | IDENTIFICADO |
| Pansear | `sm3-22` 22/147 Sombras Ardentes | IDENTIFICADO |
| Dragonair | `sm1-95` 95/149 Sol e Lua | IDENTIFICADO |
| Charmander | `me02.5-020` 020/217 Heróis Excelsos | IDENTIFICADO |
| Pansear | `sv07-021` 021/142 Coroa Estelar | IDENTIFICADO |

O caso Purrloin era o mais difícil: o scan pt-BR de `swsh3-106` não existe no CDN da TCGdex (404 em todas as qualidades), então o índice antigo nem continha a carta — o pipeline casava com o reprint de arte idêntica `swsh3.5-39` (Caminho do Campeão, 39/73) com confiança alta. Três correções fecharam o buraco: (1) espelho EN do scan (mesma arte, identidade pt-BR preservada) para as ~150 cartas sem scan localizado; (2) OCR de número multi-região que lê `106/189` com confiança 0,89 mesmo sob ruído; (3) veto de número contraditório — o reprint perde o bônus e a carta certa (nome+número+verificação contra o espelho EN, 272 inliers) vence com margem ampla. As correções são paramétricas (regiões/pesos reais), não overfit dessas 7 fotos.


## Pós-merge hardening (2026-09-16)
Correções de bugs de revisão independente, cada uma com regressão de comportamento em `tests/test_postmerge.py` (Python) e `tests/card-recognition-service-contract.test.mjs` (Node):

- **Orientação da rota visual**: `VisualIndex.search` usava `max` e depois comparava `>` contra o próprio máximo (impossível) — a orientação ficava sempre 0. Agora `argmax` por carta mapeia a vista vencedora para a orientação real (0/180), com desempate determinístico (raw primeiro).
- **Probe de orientação oposta**: `verify()` com quad fraco (< 0,25) repetia o probe primário em vez de testar a orientação oposta — o fallback não fazia nada. Corrigido e testado (nenhuma duplicação).
- **Número completo N/M ponta-a-ponta**: o campo `denominator` morria no mapping TypeScript (`candidate.hp === undefined ? null : null`). O serviço agora retorna `localId`/`denominator`/`cardNumber` explícitos, o TS preserva os três, e a confirmação de memória recebe o denominador correto.
- **Denominador como evidência de fusão**: `106/189` contra candidato `106/73` não é "número que bate" — é conflito de denominador (reprint de outro set): penalidade simétrica ao veto de N e teto `PROVÁVEL`. OCR fraco nunca veta (guardas de confiança).
- **Memória recalibrada**: threshold + margin calibrados por benchmark dedicado (positivos = mesma carta sob degradação independente; negativos = carta mais parecida do índice, incluindo gêmeos de idioma). Ver `config.py`.
- **Fila para lotes de 20/50 fotos**: o serviço executa reconhecimentos em executor limitado (`RECOGNITION_MAX_CONCURRENCY`, default 1; OCR não roda mais no event loop — `/health` responde durante lotes), e o cliente agenda com concorrência limitada mostrando "Na fila de reconhecimento… (N cartas na frente)". O timeout por requisição mede **execução** — esperar na fila nunca derruba a foto para o pipeline do navegador.
- **CORS configurável**: `RECOGNITION_ALLOWED_ORIGINS` (defaults localhost; nunca `*`), com resposta ao preflight de Private Network Access para o painel https na Vercel chamar o serviço loopback. O bind continua `127.0.0.1`.
- **`/health` = readiness**: `ready: true` só quando catálogo + índice + modelos carregados; o cliente só usa o pipeline local com `ready` (não apenas `status: ok`).
- **Integridade de cache de scans**: cache hit também é validado por magic-bytes (HTML > 4 KB envenenava o cache para sempre) — inválido é removido e baixado de novo; a imagem decodifica ou vira miss.
- **Catálogo não marca parcial como completo**: sets que falham (após retry de transporte + retry de set) são reportados em `catalog.gaps.<language>`; o stamp de completo só é gravado com 100% dos sets; exit non-zero para jobs agendados. Dados bons nunca são apagados por um fetch parcial.
- **Modelos reproduzíveis**: `download_models.py` fixa a revision exata de cada repo HF (os thresholds foram calibrados para esses pesos), instala com tmp+rename atômico, valida que o ONNX abre e grava manifest com sha256 (`--verify` re-checa).
- **URL de imagem utilizável**: candidatos resolvidos via `low.webp`/espelho EN não anunciam mais o `high.webp` do CDN (404) — o serviço aponta para o endpoint local `/scan/{language}/{cardId}`, que serve o que realmente resolveu.
- **CI testa Python de verdade**: job `recognition-python` roda `compileall` + `unittest discover` (deps leves; benchmarks pesados seguem manuais) e o job Windows valida a sintaxe dos `.ps1`.

## Rodada de performance 2026-09-17 (branch `perf/recognition-redistribution`)

Objetivo: mesma precisão, menos trabalho redundante. Sem troca de modelos, sem ANN, sem quantização, sem mudança de thresholds.

**Correções de bugs**
- `scan_source` sobrevive ao cache hit de scans decodificados (a 2ª identificação da mesma carta voltava a anunciar `high.webp`, que 404 para cartas resolvidas via `low.webp`/espelho EN).
- Cache negativo com TTL por classe de falha: 404 vira 6 h, 429 vira 60 s, timeout/5xx vira 120 s (antes era "para sempre" — um único timeout escondia um scan perfeitamente baixável até reiniciar o processo).
- Instalador: idiomas **CORE** (pt-BR/en) incompletos bloqueiam (exit 1); idiomas **OPCIONAIS** (es/ja) registram gaps em `catalog.gaps.<lang>` e NÃO bloqueiam mais. Re-run com gaps pendentes refaz **apenas os sets falhados** (`sets_filter`); sets que sumiram do listing são reportados, não fake-success.

**Menos trabalho redundante (idêntico em precisão)**
- SIFT da query: 1 extração por probe por requisição (era 1 por candidato: 4x no fast path, 12-20x no caminho completo). `match()` segue existindo e é byte-idêntico a `extract()`+`match_features()`.
- Cache LRU de features SIFT dos scans oficiais, com orçamento de bytes e chave `language|cardId|scanSource`.
- HTTP: `requests.Session` por thread (keep-alive) + retries por classe de falha (404 definitivo, 429 respeita `Retry-After` curto, 5xx/timeout backoff exponencial com jitter).

**Instalação/índice**
- `build_index.py`: pipeline com producer thread (download+decode sobrepõem inferência, fila limitada `--prefetch`), checkpoint validado ao retomar (rows/ids/next_id) e profiling por fase (download/decode/inferência/checkpoint ms/cartão).
- `download_scans.py`: ETA suavizada + taxa no progresso.

**DirectML (AMD RX 570 / Windows)**
- `recognizer/ort_session.py`: factory compartilhada aplicando as restrições oficiais do DirectML EP (`enable_mem_pattern=False` + `ORT_SEQUENTIAL`; rodar com mem-pattern ativo **quebra em runtime**) e serialização de `Run()` por session quando ela roda de fato em DML (Run concorrente no mesmo session DML não é seguro).
- `RECOGNITION_PROVIDERS=cpu|dml|cuda|auto` — `cpu` força CPU se o benchmark na máquina-alvo mostrar DML mais lento/instável.
- `scripts/benchmark_runtime.py`: compara CPU vs DML por session e no pipeline completo (warm-up separado do steady-state, mean/P50/P95/max, RSS de pico, memória GPU best-effort, erros visíveis). Rode na máquina-alvo antes de concluir qualquer coisa sobre DML.

**/health e caches**
- `warm()` carrega também a session do embedding (ready = a próxima foto sai em velocidade total, sem stall de criação de session).
- `backend.runtimeProviders`: provider REAL por session (embedding/ocrDetector/ocrRecognizer) — o ORT silenciosamente cai para CPU quando o DML não inicializa; listar providers disponíveis não é evidência de GPU.
- `caches`: contadores de observabilidade (hits/loads/negativeHits/extractions/evictions/entries/bytes) para decidir tuning com números.

**UI (relato: congelamento total durante e após o reconhecimento)**
- Previews do wizard em ~560 px JPEG (upload continua com o arquivo original); inspector ~1000 px; `loading=lazy` + `decoding=async` em todas as previews.
- `JSON.stringify` dos detalhes só na primeira abertura do `<details>` (era a cada render, por carta expandida, com várias renders/s).
- Progresso da UI limitado a ~6 paints/s (o reconhecimento em si não muda).
- Cornelius (fallback do navegador): inferência ONNX + warp de perspectiva agora em Web Worker (`card-recognition-cornelius.worker.ts`), com fallback inline intacto.

## Rodada de estabilidade 2026-09-17 (branch `fix/crash-stability-catalog`)

Contexto do relato na máquina-alvo (Windows, Ryzen 5 3500, RX 570 4 GB): o serviço local morria com `3221225477` (`0xC0000005`, access violation nativa) logo após `RuntimeWarning: invalid value encountered in multiply/divide` vindos de `embed.py` — output do SigLIP2 com NaN. O checkout local rodava o PR #17, onde a seleção de provider era GPU-first com as opções de session defaults (`enable_mem_pattern=True`), exatamente a combinação que a documentação oficial do DirectML EP diz não suportar; o PR #18 já havia corrigido as opções de session, mas não existia validação numérica nem fallback de provider.

**Estabilidade numérica (a imagem ruim não pode matar o processo)**
- Todo chunk de embedding é validado: shape/dtype, finitude antes da norma, norma > `1e-6`, finitude depois da normalização. Qualquer violação levanta `InvalidEmbeddingError` com diagnóstico completo (stage, model, provider, shapes, min/max/mean, contagens de NaN/inf) — nunca `nan_to_num`, nunca propagação silenciosa para cosine/retrieval/fusion/memória.
- Fail-safe por requisição: embedding inválido desabilita SOMENTE a rota visual daquele request; OCR/candidatos textuais seguem e a decisão reflete honestamente a evidência faltante (`visualError` no payload). O processo continua vivo.
- Índice com linhas NaN/inf falha rápido no load com instrução de rebuild (uma linha NaN envenena cada argmax).
- CTC do OCR: probabilidades não-finitas leem nada (nunca um caractere errado); confiança não-finita é descartada.

**Demotion de provider (estabilidade > velocidade teórica)**
- 2 outputs inválidos no mesmo provider não-CPU (configurável) reconstrói a session em CPU e grava `provider-demotion.json`; a seleção `auto` pula providers demotidos por até 168 h (`RECOGNITION_DEMOTION_TTL_HOURS`), `RECOGNITION_PROVIDER_DEMOTION=0` desativa o mecanismo e `RECOGNITION_PROVIDERS=dml` explícito nunca é filtrado.
- **Crash journal**: `last-request.json` escrito no início de cada request e removido no fim. Se o arquivo sobreviver, o processo anterior morreu no meio de um request — os providers que executavam são demotidos no próximo startup. Um crash nativo não se repete na mesma foto.
- `/health` (v1.3.0): bloco `stability` com `invalidEmbeddings`, `providerDemotions`, `previousRunCrashed`, e `backend.demotedProviders`.
- `npm start`: restart supervisionado e limitado do serviço local (máx. 2 em 10 min) — crash nativo recupera em CPU em vez de deixar o site sem o pipeline forte.

**Failed to fetch diagnosticado**
- O fallback do navegador agora distingue a causa: processo morto (TypeError do fetch), timeout (AbortError/TimeoutError) e erro HTTP (status). "Failed to fetch" era o sintoma do crash do processo, não um diagnóstico.

**Congelamento restante do navegador (P0)**
- Causa raiz: o pipeline de OCR do navegador (`card-recognition-ppocr.ts`) rodava com `execution: "main"` — 4 passes de inferência WASM + realce por pixel POR CARTA na main thread. Com o serviço local morto e 20+ cartas, a página travava por completo.
- Correção: `card-recognition-ppocr.worker.ts` hospeda o pipeline inteiro (load do SDK, recortes, realce, 4 passes, pós-processamento) num Web Worker dedicado; o caminho inline permanece como fallback (sem Worker / erro / timeout). Mesmo SDK, mesmo modelo, mesmos passes — só a thread muda.

**Reconhecimento OFF (teste que falhava só na máquina do usuário)**
- Causa: o regex do teste usava `\n` mas o checkout Windows com `autocrlf` grava `\r\n` em disco. Comportamento OFF real estava correto; o teste agora normaliza line endings e também afirma que o guard precede o registro in-flight e o probe de health.

**Cobertura do catálogo (TCGdex)**
- A fonte já era a TCGdex com todos os sets (en=220/pt=125/es=156/ja=184, sem truncamento). O gargalo real: cartas SEM scan publicado (~10% dos promos, ex. 22/307 do swshp) eram descartadas do DB — invisíveis até para OCR. Agora são gravadas com `scan_status="not_available"` e continuam candidatas de rota B (OCR/texto); o índice visual não muda (sem scan, sem embedding) — zero risco de regressão de precisão.
- `download_scans.py` agora é um sincronizador com máquina de estados na tabela `scans`: `validated` (com sha256 gravado no download; re-runs pulam com zero rede), `failed` (retry no próximo run), `not_available` (gap de catálogo, sem retry). Corrupção detectada por sha256 leva a re-download no mesmo run.
- `scripts/stress_service.py`: benchmark de longa duração (20/50/100 requests consecutivos) medindo processo vivo, mean/P50/P95/max, decisões, embeddings inválidos e crescimento de RSS; exit non-zero em qualquer falha.

### Variáveis de ambiente novas

| Variável | Default | Efeito |
|---|---|---|
| `RECOGNITION_SCAN_CACHE_MB` | `400` | Orçamento de RAM do cache de scans decodificados |
| `RECOGNITION_SIFT_CACHE_MB` | `128` | Orçamento do cache de features SIFT (`0` desativa) |
| `RECOGNITION_PROVIDERS` | `auto` | `cpu`/`dml`/`cuda` força o provider das sessions ONNX |
| `RECOGNITION_PROVIDER_DEMOTION` | `1` | `0` desativa o mecanismo de demotion de provider instável |
| `RECOGNITION_DEMOTION_TTL_HOURS` | `168` | Horas que um provider demotido fica fora da seleção `auto` |
| `RECOGNITION_PROVIDER_DEMOTION_AFTER` | `2` | Outputs inválidos no mesmo provider antes do demotion |
| `RECOGNITION_EMBED_CHUNK` | `2` | (existente) batch interno do embedding — só mude com benchmark |
| `RECOGNITION_MAX_CONCURRENCY` | `1` | (existente) paralelismo de reconhecimento no serviço |

## Rodada de catálogo multi-fonte 2026-09-17 (branch `feat/catalog-multisource`)

Objetivo declarado da rodada: EN + JA + pt-BR o mais completo possível, com identidade vs printing, reconciliação de fontes, detecção de lacunas e MAIOR RECALL — sem sacrificar precisão nem latência.

**Fontes (verificadas ao vivo, disponibilidade registrada em `sources.status`)**
- **TCGdex** (primária): descoberta dinâmica de séries/sets/cartas em todos os idiomas. Nenhum id de set é fixado no código — o listing é relido a cada execução e comparado ao censo por-set (`catalog.sets_census.<lang>`): expansão nova amanhã é detectada e baixada sozinha, sem `--refresh`.
- **pokemon-tcg-data** (EN): 176 sets / 20.6k cartas com number/rarity/subtypes/imagens — reconciliado contra o TCGdex por chave (idioma, set, localId normalizado). Sets casados por id exato, depois nome+data(±45d)+contagem (sem listas fixas). TG/GG/SV subsets existem só no TCGdex e aparecem como `only-tcgdex` no relatório — nada é forçado.
- **pokemon.com**: Indapsula (JS challenge) em toda página de carta — não consumível por HTTP; registrado como indisponível com o motivo.
- **pokemon-card.com** (JA oficial): busca renderizada no cliente, sem JSON público — registrado como indisponível.
- **cartasdepokemon.com.br**: app client-side com sitemap podre (todas as URLs 404) — registrado como indisponível.

**Números reais do sync completo (2026-09-17, API ao vivo)**
- pt-BR: 13.907 cartas · 125 sets · scans 12.746 primários **+ 709 espelho de 2a fonte** · 1.161 not_available
- en: 23.849 cartas · 220 sets · scans 19.666 primários **+ 965 de 2a fonte** · 4.183 not_available · 269 conflitos registrados
- ja: 12.781 cartas · 184 sets · scans 3.882 · 8.899 not_available · **5 sets "fantasma" upstream** (SM1+, sm2+, SM3+, SM4+, SM5+ — o TCGdex lista com cardCount mas o endpoint responde 503 e as cartas não existem em nenhum outro endpoint; 336 cartas)
- es: 15.510 cartas (opcional, não-bloqueante)
- reconcile EN: 174/176 sets casados · 20.484 cartas em ambas · 3.253 só-TCGdex (TG/GG/SV + promos) · 116 só-pokemon-tcg-data (inseridas com fonte marcada) · 20.194 raridades enriquecidas · 852+709 imagens alternativas
- Total: **66.047 cartas** (vs 37.643 da rodada anterior — en+pt)

**Modelo de dados v2 (migração aditiva, funciona no cards.sqlite existente)**
- Cada linha é um *printing*; `canonical_id` (set|localId) liga gêmeos de idioma do mesmo set internacional (pt sv01-025 ↔ en sv01-025).
- Colunas novas: `rarity`, `subtypes`, `canonical_id`, `image_alt`, `sources` (JSON com ids nativos por fonte); tabela `conflicts` (sourceA, sourceB, field, valueA, valueB, resolution — nada é sobrescrito silenciosamente); `scans` ganha `width`/`height`/`source`.
- Política de merge determinística: imagem TCGdex vence (a cadeia de cache é indexada nela); rarity/subtypes do pokemon-tcg-data quando o TCGdex não tem; nome/denominador conflitantes são registrados e o valor TCGdex mantido (a calibração é dele).

**Backfill de imagens da 2a fonte (o ganho de recall)**
- Cadeia de resolução por carta: scan próprio → espelho EN do TCGdex → **imagem pokemon-tcg-data (hires → small)**, validada por magic bytes + decode + dimensões mínimas (200x280) + sha256. Cartas sem scan no TCGdex (4.070 en + 1.161 pt) ganham a arte EN equivalente quando existe — entram no índice visual em vez de ficarem invisíveis.
- pt-BR de sets internacionais (sv01, svp, …): mesma arte, CDN independente — 709 cartas.

**Gaps: detecção, retry e "upstream-unavailable"**
- `catalog.gaps.<lang>` lista os sets falhos; a próxima execução busca SOMENTE eles (validado ao vivo: ja re-buscou 5/184 sets, o resto "up to date").
- Set que falha 3 execuções seguidas (503 persistente do lado da fonte) vira `upstream-unavailable`: continua registrado e retentado (self-healing), mas NÃO bloqueia mais a instalação. Validado ao vivo com os 5 sets fantasma do ja.
- Stamp `catalog.updated.<lang>` só quando TODO set esperado foi buscado; caso contrário o relatório diz `partial` com os gaps explícitos.

**Reconhecimento (mudanças conservadoras, sem tocar thresholds/Top-K/fusão)**
- `variants` agora é povoado (era vazio em TODAS as 37k cartas — o set endpoint do TCGdex não fornece; per-card/details + pokemon-tcg-data trazem). Rótulo de variante + `rarity` no payload do candidato (metadado de exibição, peso zero na fusão).
- Números alfanuméricos de colecionador: `TG05/TG30`, `GG07`, `SVP001`, `SM99` parseados como evidência ADICIONAL (só quando o caminho numérico N/M não leu nada; blacklist de HP/PS/GX/…; confusáveis de dígito alinhados pelo prefixo comum do par; `SVP001`→`001` casa com sets promo via tail-match mais fraco). N/M numérico continua com prioridade total.
- Nomes japoneses: normalização CJK (nomes ja colapsavam para "" — bucket único, rota B cega para ja).

**A/B benchmark (mesmas fixtures n=74, mesmos modelos, mesmo processo sandbox)**
- BASE 7952c97 vs NEW: Top1 89,2→95,9 · Top3 94,6→100 · Top5 97,3→100 · name 95,9→100 · set 94,6→98,6 · N/M 91,9→98,6 · idioma 95,9→97,3 · IDENTIFICADO 36,5→40,5 · **falseHigh 0→0** · P50 13,1s→11,0s · P95 20,6s→20,1s.
- Zero regressões por fixture; 5 melhorias — todas nas classes-alvo (cartas só-2a-fonte e subsets TG).
- Escala do índice (medido, busca Top-50 de 4 views, dim 768): 25k linhas 10 ms → 66k 32 ms → 150k 80 ms. O catálogo grande não destrói a latência (rota A continua brute-force; SIFT só no Top-12).
- Bug real corrigido no caminho: checkpoints do `build_index.py` nunca disparavam com batch=8 (`processed % 500 == 0` é inalcançável em passos de 8) — build interrompido recomeçava do zero apesar da promessa de retomável.

### Variáveis de ambiente novas (além das da rodada de estabilidade)

| Variável | Default | Efeito |
|---|---|---|
| `RECOGNITION_CATALOG_CARD_DETAILS` | `1` | `0` desativa o enriquecimento per-card (rarity/variants via endpoint individual do TCGdex; incremental, só linhas sem rarity) |
| `INDEX_CHECKPOINT_EVERY` | `500` | Intervalo mínimo de cartas entre checkpoints do índice |

### Ferramentas da rodada
- `scripts/build_catalog.py`: sync incremental multi-fonte + reconciliação + relatório de cobertura (`catalog.coverage.<lang>`) + `--no-card-details` / `--details-limit`.
- `scripts/download_scans.py`: sincronizador com validação completa (magic bytes + decode + dimensões + sha256) e estados por scan.
- `scripts/smoke_catalog_round.py`: smoke E2E ao vivo (fontes reais, slice limitado).
- `scripts/benchmark_index_scaling.py`: escala da busca vs tamanho do catálogo.
- `tests/test_catalog_round.py`: 41 testes (descoberta incremental, resume, gaps, corrupt, checksum, reconciliação, conflitos, EN/JA/pt, números alfanuméricos, identidade/printing, variantes/rarity).

## Instalação (Windows)

```powershell
npm run recognition:install   # venv + deps (GPU NVIDIA detectada automaticamente) + modelos + catálogo + índice
npm run recognition:local     # serviço em 127.0.0.1:8765
npm run start                 # site + bot + este serviço (opcional; sem ele o site usa o pipeline do navegador)
```

Equivalente direto: `recognition\install-windows.ps1` e `recognition\run-local.ps1`.

### Painel Vercel + serviço local

O painel publicado na Vercel (https) pode usar o serviço local (loopback é isento de mixed-content nos navegadores atuais). Configuração:

```powershell
# libere a origem do painel no serviço local (lista explícita, nunca "*")
$env:RECOGNITION_ALLOWED_ORIGINS = "https://seu-dominio.vercel.app"
recognition\run-local.ps1
```

O serviço responde ao preflight de **Private Network Access** (`Access-Control-Allow-Private-Network: true`) que o Chrome exige para página pública -> serviço loopback, e continua bindado apenas em `127.0.0.1`. Sem a variável, só as origens localhost (3000/3001) são aceitas. Múltiplas origens: separar por vírgula.

- Modelos (ONNX, de Hugging Face, via `scripts/download_models.py`): **core** = SigLIP2-base-384 + PP-OCRv6 medium (~1.6 GB, instalação padrão); **extras** (`--extras`) = DINOv3-S (fallback leve) + ALIKED/LightGlue (matcher aprendido — o SIFT default já vem com o OpenCV); `--all` soma os backbones de bake-off.
- Catálogo: TCGdex → SQLite local (todos os idiomas); scans oficiais em cache local com cadeia de qualidade (`high.webp` → `low.webp`) validada por magic-bytes (o CDN devolve HTML com HTTP 200 para nomes inválidos — nunca entra no cache) e espelho EN para cartas sem scan no idioma local (mesma arte/identidade; ~150 cartas pt-BR). A instalação baixa pt-BR (≈ 12,7k) + en (≈ 19,5k); es/ja ficam apenas nos metadados.
- Índice: `build_index.py --model siglip2-base-384 --batch 8` (batch maior causa OOM; valor validado) com checkpoint incremental — pt-BR primeiro (12.744 cartas = 100% do catálogo), en em seguida; interromper/retomar sem perder trabalho.
- GPUs: CUDA/DirectML detectadas automaticamente pelo ONNX Runtime.

## Estrutura

```
recognition/
├── recognition_server.py     # FastAPI: /health /recognize /scan /memory /reload-index
├── recognizer/
│   ├── normalize.py          # detecção/retificação + gamma_auto/photometric_variants
│   ├── embed.py              # ONNX embeddings (SigLIP2, DINOv2/3) com interface comum
│   ├── features.py           # SIFT/AKAZE/ALIKED+LightGlue + RANSAC
│   ├── ocr.py                # PP-OCRv6 por regiões + consenso de número
│   ├── hints.py              # hints textuais + overrides de regressão
│   ├── catalog.py            # TCGdex → SQLite + cache de scans (magic-bytes)
│   ├── store.py              # consultas de catálogo/candidatos textuais
│   ├── memory.py             # memória confirmada (threshold+margin calibrados)
│   ├── pipeline.py           # rotas A/B + fusão (N/M completo) + decisão honesta
│   └── config.py             # caminhos, calibração, CORS, concorrência
├── scripts/                  # build/download/benchmark/bake-off/calibração/splits
├── tests/                    # test_units.py + test_postmerge.py (sem modelos)
└── data/                     # (local, gitignored) catálogo, scans, índices, fixtures
```

## Privacidade

Tudo roda localmente. Nenhuma API paga, nenhuma imagem enviada a serviços externos. O serviço liga apenas em `127.0.0.1` e aceita CORS apenas da lista explícita de origens (defaults localhost; domínio de produção via `RECOGNITION_ALLOWED_ORIGINS`).
