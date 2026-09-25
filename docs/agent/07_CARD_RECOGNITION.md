# 07_CARD_RECOGNITION — Reconhecimento de cartas (recognition/)

> Área: Reconhecimento
> Escopo: Pipeline, modelos, catálogo, serviço HTTP, integração, benchmarks, env
> Última atualização: 2026-09-23
> Fonte principal: `recognition/recognition_server.py`, `recognition/recognizer/**`, `recognition/scripts/**`, `recognition/README.md`, `docs/card-recognition.md`, `lib/card-recognition-local.ts`, `scripts/recognition-shared.mjs`

## Arquitetura do pipeline (`recognizer/pipeline.py::recognize`)

Duas rotas independentes + fusão + decisão honesta (`IDENTIFICADO | PROVAVEL | REVISAR | NAO_IDENTIFICADO`):

1. **Rota A (visual, nunca gated por OCR)**: `normalize_card` (quad-contour/Hough/aspect → 600×840) → embedding **SigLIP2-base-384** multi-view (0°/180° × raw/gamma-auto, `photometric_variants`) → busca exata por cosseno no índice em RAM (`VisualIndex`, ~37.917 linhas) → Top-50.
2. **Rota B (texto)**: PP-OCRv6 medium por regiões (`recognizer/ocr.py`): topo (nome/HP), banda "name2", footer (idioma/número backup) e **5 regiões de número** (canto completo, banda larga, faixa esquerda 60%, curta esquerda e **canto inferior direito** — layout pré-2011 WotC imprime "N/M" itálico à direita); escada de denoising (raw → bilateral → Otsu); consenso exige o mesmo N/M duas vezes.
3. **Verificação geométrica**: SIFT + RANSAC homografia (`recognizer/features.py`) no Top-12 + candidatos por OCR; inliers ≥ 12 e razão ≥ 0,30 = evidência quase-conclusiva.
4. **Fusão** (`fuse`): pesos calibrados por modelo (`EMBEDDING_CALIBRATION` em `config.py`; SigLIP2: floor 0,89 / strong 0,91); verificação domina (220×score); nome/número/idioma/HP como validação; **memória confirmada** é auxiliar (≤55 pontos, nunca gera IDENTIFICADO sozinha).
5. **Decisão** (`decide` + `_cap_uncertain_language`): margem sobre o melhor candidato DIFERENTE; conflitos de número/denominador caps; língua decidida depois da identidade (dois passos).

### Regras especiais incorporadas (todas com testes de regressão)

- **Guard anti-"ja" falso** (`recognizer/hints.py::detect_language`): ≥4 glifos CJK (ruído medido era 1–3; ja real ≥51).
- **Devir pré-2011** (`pipeline.py::_cap_uncertain_language` + `_is_pre_2011_pt_print`): leitura forte pt-BR contra vencedor EN de set < 2011 → decisão mantida, evidência `pt-br-pre-2011-print`, `languageStatus "pt-br-pre-2011"`. Pós-2011/desconhecido continua conflitante (REVISAR).
- **Corroboração de denominador** (`fuse` + `_digits_close`): M lido existe no pool → tri-state estrito; M a 1–2 dígitos de alguém → ruído de OCR (inerte — não depõe a carta certa); M distante de todos → veto mantém.
- **Upgrade de memória**: usa o vencedor real de `ranked` (bug histórico: testava `result.best` antes de existir).

## Serviço HTTP (`recognition_server.py`, FastAPI, 127.0.0.1:8765)

- Endpoints: `/health` (readiness ESTRITA: catálogo + índice + modelos + secret ≥32; `warming`, `idleUnloadMinutes`), `/recognize`, `/scan/{lang}/{id}`, `/catalog/exists` (ghost-lot guard), `/memory/confirm|GET|DELETE`, `/reload-index`.
- **Auth**: token HMAC de curta duração mintado pelo Next (`/api/card-recognition/token`) e verificado em `recognizer/service_auth.py` (aud `pokemon-card-recognition`, skew 30s, TTL ≤15min).
- **Ciclo de RAM**: modelos carregam na 1ª foto (sem `--preload`); watchdog descarrega tudo após `RECOGNITION_IDLE_UNLOAD_MINUTES` (10) de inatividade; `/health` frio arma warm em background (o próximo probe, TTL 60s, já acha `ready=true`).
- **Concorrência**: `RECOGNITION_MAX_CONCURRENCY` (1) — executor limitado; fila reportada como `queueMs` separado de `executionMs`.
- **Observabilidade**: `/health` expõe providers reais por sessão (`runtimeProviders`), demotions (`provider-demotion.json`, TTL 168h), journal de crash (`last-request.json.*`), caches (scan/SIFT com orçamentos `RECOGNITION_SCAN_CACHE_MB=150`, `RECOGNITION_SIFT_CACHE_MB=48`).
- **Env**: `recognition/.env` carregado pelo próprio Python (`recognizer/config.py::load_local_env`, setdefault — env real vence); CORS allow-list `RECOGNITION_ALLOWED_ORIGINS` (nunca `*`; responde preflight Private Network Access p/ painel https da Vercel).

## Catálogo e índice

- Fontes: **TCGdex** (primária, todos os idiomas) + **pokemon-tcg-data** (EN, reconciliação + raridade + imagens alt) + Limitless (opcional `LIMITLESS_API_KEY`); sincronização incremental com detecção de gaps por set (upstream-unavailable não bloqueia).
- Estado atual (2026-09-23, máquina do operador): 57.148 cartas (pt-BR 13.907 / en 23.849 / ja 3.882 / es 15.510); **índice visual 37.917** = pt-BR+en+ja completos; **es: 13.271 cartas com scan fora do índice** (build morreu 3× com NaN do DirectML; build agora força CPU — ver `11_PENDING_WORK.md`).
- Dados locais (`recognition/data/card-index/`, gitignored): `cards.sqlite`, `image-cache/` (~5,6 GB), `embeddings/siglip2-base-384.npz`, `memory.json` + `memory-embeddings.npz` + `memory-images/`.
- Modelos (`recognition/models/`): `siglip2-base-384.onnx` (~1,5 GB), `ppocrv6-medium-det/rec.onnx`; manifest com sha256 (`scripts/download_models.py --verify`).

## Integração com o Next.js

- Cliente: `lib/card-recognition-local.ts` (probe/strict ready, token com retry 401, scheduler de concorrência, timeouts: health 1,2s; recognize 120s de EXECUÇÃO).
- **Pipeline ativo VISÍVEL (2026-09-24)**: `probeRecognitionPipeline()` faz probe + MINT de token (o probe sozinho MENTE no painel publicado: o navegador do operador alcança 127.0.0.1:8765, mas o mint é server-side — Vercel sem `RECOGNITION_SERVICE_SHARED_SECRET` não minta nada e cada foto degrada em silêncio para o NAVEGADOR). O wizard mostra o chip: serviço local ✅ / ⚠ NAVEGADOR (com a causa: `npm run start` desligado no PC OU secret ausente na Vercel — P-11); resultados auto-corrigem o chip (`result.localPipeline`). Sintoma real que motivou (2026-09-24): "verificação de cartas muito ruim de novo" no painel da Vercel = browser fallback.
- Contrato de tipos: `lib/card-recognition-service-contract.ts` (`languageStatus: confirmed|uncertain|conflict|pt-br-pre-2011`; decisão → `IDENTIFICADA|PROVÁVEL|REVISAR|SEM RESULTADO`).
- Wizard consome `mapServiceResult` e nunca bloqueia cadastro por falha de IA (regra de projeto nº 1 do recognition/README: OCR nunca é gatekeeper).

## Testes e benchmarks

- Testes Python: `recognition/tests/` (248 casos; sem modelos pesados): `test_units.py`, `test_postmerge.py` (idioma gêmeas, denominador, memória, Devir), `test_stability_round.py`, `test_perf_round.py`, `test_catalog_round.py`. Rodar: `.venv\Scripts\python.exe -m unittest discover -s tests` (a partir de `recognition/`).
- Benchmarks/ferramentas (`recognition/scripts/`): `benchmark.py` (fixtures sintéticas + splits sem vazamento `split_fixtures.py`/`calibrate_thresholds.py`), `bakeoff_embeddings.py`, `benchmark_memory.py`, `benchmark_runtime.py` (CPU vs DirectML), `stress_service.py`, `diagnose_hard.py`, `analyze_failures.py`, `make_fixtures.py`.
- Referência de qualidade: `recognition/README.md` (Top-3 98,1% sintético; 7/7 fotos reais pt-BR; pré-2011: identidade correta 22/22 com N/M lendo em resolução realista).
- Benchmarks do site: `benchmarks/` (Node) + `lib/card-recognition-benchmark.ts`.

- **RAM idle-unload completo (2026-09-24)**: o watchdog soltava só ~170 MB de ~1,1 GB porque raízes de módulo (mbed.MODELS, singleton PpOcr) seguravam as sessões ONNX. elease() agora fecha as sessões em cada raiz antes do gc; medido ao vivo: carregado 1335 MB → ocioso **184 MB**, com rewarm automático no próximo probe e E2E verde.
- **Retake hint (2026-09-24)**: mapServiceResult propaga 
ormalization.confidence; o wizard em lote mostra dica de tirar outra foto quando o enquadramento <0,5 e a carta não foi identificada — os NAO_IDENTIFICADO dos holdouts reais eram TODOS foto escura/torta (brilho ~100–114, warp 0,36–0,67, carta verdadeira fora do top-50).
- **Holdout real (96 fotos do operador, 2026-09-24)**: lote 1 (53): 15 IDENTIFICADO / 35 PROVAVEL / 0 REVISAR / 3 NAO (todos foto ruim ou impressão fora do catálogo — Numel 56/106 não existe; ex9-56 é Mudkip). Lote 2 zap (43, fotos melhores): **21 IDENTIFICADO (49%)** / 19 PROVAVEL / 1 REVISAR / 2 NAO. A qualidade da foto é O fator (28% → 49%).
- **RAM medido (2026-09-24)**: ocioso com tudo ligado ~900 MB–1 GB (IA ociosa 184 MB, site ~300, bot 400–600 com heap cap 384); IA carregada ~1,1–1,5 GB; reconhecimento ~3–9 s/foto quente.

## Riscos

- DirectML (RX 570) pode produzir NaN — pipeline tem validação por request (fail-safe rota A) + demotion automático p/ CPU após 2 outputs inválidos; builds de índice FORÇAM CPU no Windows.
- Índice e catálogo são LOCAIS: outra máquina precisa rodar `npm run recognition:install`.
- `es` fora do índice visual: cartas em espanhol caem para OCR/texto.
- Upload grande: limite 25 MB / 12.000 px (413).
- P-01 CORRIGIDO (2026-09-23): os endpoints de memória/catálogo usavam `verify_service_token` cru → `ServiceAuthError` não é `HTTPException`, o FastAPI devolvia **500 + traceback** para chamadas sem token (bundle antigo da Vercel). Agora usam `require_service_auth` (401/503 limpos).
