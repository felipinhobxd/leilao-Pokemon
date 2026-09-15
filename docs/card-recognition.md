# Reconhecimento de cartas Pokémon

## Objetivo

O cadastro em lote tenta identificar a carta antes do upload definitivo da imagem. O recurso é auxiliar: qualquer falha mantém o cadastro manual disponível e nunca bloqueia a criação do leilão.

## Arquitetura

O reconhecimento acontece em duas camadas, em ordem de preferência:

1. **Serviço local forte** (`recognition/`, Python + ONNX, ligado em `127.0.0.1:8765`): pipeline de duas rotas independentes com fusão de evidências.
2. **Fallback no navegador** (pipeline v11: normalização neural + PP-OCRv6 WASM + catálogo TCGdex) quando o serviço local está offline.

O site detecta o serviço local via `GET /health` (cache de 60 s, backoff de 60 s em caso de falha). Se o serviço falhar no meio de um reconhecimento, o navegador degrada para o pipeline local sem interromper o fluxo.

### As duas rotas do serviço local

**Rota A — visual (nunca depende de OCR):**

1. Detecção do contorno da carta (múltiplas estratégias de binarização: Canny, Otsu, adaptativo) e retificação de perspectiva para 600×840.
2. Embedding global do cartão normalizado (SigLIP2-base-384 ONNX) em múltiplas vistas: orientações 0°/180° × fotometria (raw + gamma-auto). O score de cada carta do catálogo é o máximo entre as vistas — fotos escuras/lavadas são resgatadas pela vista gamma.
3. Busca exata por cosseno no índice local (12.588 cartas pt-BR + EN) → Top-50.
4. Verificação geométrica dos melhores candidatos: SIFT + RANSAC homografia; inliers e razão de inliers são evidência quase-conclusiva. A pontuação é discriminativa na região da arte (molduras compartilhadas entre Trainer/Item não dominam o match).

**Rota B — texto:**

1. PP-OCRv6 medium (ONNX) por regiões (nome, HP, número, denominador, rodapé/set), com confiança por leitura e fallback full-card.
2. Hints textuais (nome/número/HP/idioma) → candidatos do catálogo local por similaridade.

**Fusão:** verificação geométrica + similaridade global + validação de metadados OCR + memória confirmada → decisão em categorias honestas: `IDENTIFICADO`, `PROVÁVEL`, `REVISAR`, `NAO_IDENTIFICADO`. Nenhum percentual inventado.

### Regras de projeto invioláveis

- **OCR nunca é gatekeeper.** OCR lixo (ex.: "escia" numa carta Shroodle) não impede a identificação visual. Regressão obrigatória: Shroodle deve ser achado mesmo com OCR lendo `escia`.
- Número OCR parcial/errado não restringe sozinho o catálogo (regressão: Dragonair não vira Parasect).
- Nome correto + candidatos corretos, mas impressão exata sem evidência suficiente (reprints com arte idêntica, rodapé ilegível) → `PROVÁVEL`/`REVISAR`, nunca uma carta errada com confiança alta.
- Memória confirmada: apenas a confirmação explícita do usuário cria ground truth; predições nunca são auto-salvas.

## Instalação e execução

```powershell
npm run recognition:install   # venv + dependências (GPU NVIDIA detectada automaticamente) + modelos + catálogo + índice
npm run recognition:local     # sobe o serviço em 127.0.0.1:8765
npm run start                 # site + bot + serviço local de reconhecimento (opcional: ausência degrada para o pipeline do navegador)
```

No Windows, os equivalentes diretos são `recognition\install-windows.ps1` e `recognition\run-local.ps1`. O índice é reconstruído com `npm run recognition:index` (com checkpoint incremental — interrupções retomam de onde pararam).

## Privacidade e custo

- Nenhuma API de IA paga é usada; nenhum dado sai da máquina do usuário.
- Nenhuma imagem é enviada a OpenAI, Gemini, Claude, AWS, Google Vision, Azure Vision ou equivalente.
- Os modelos ONNX rodam localmente via ONNX Runtime (CUDA/DirectML/CPU automático). A instalação padrão baixa o essencial (SigLIP2-base-384 + PP-OCRv6 medium, ~1.6 GB); DINOv3-S e ALIKED/LightGlue são opcionais (`download_models.py --extras`).
- O catálogo TCGdex é baixado uma única vez para SQLite local; scans oficiais ficam em cache local — o site não consulta a TCGdex durante o reconhecimento quando o serviço local está ativo.

## Performance

- Modelo de retrieval carregado uma vez na memória; índice de embeddings em RAM (busca bruta por cosseno — 12–80k cartas cabem em força bruta).
- Reconhecimento típico: centenas de ms por foto com GPU; poucos segundos em CPU.
- Cache por SHA-256 em memória + `sessionStorage`: a mesma imagem não é reconhecida duas vezes na sessão.

## Campos automáticos

Podem ser preenchidos somente quando há confiança suficiente:

- Nome, coleção/edição, número da carta, idioma (`pt-BR`, `en`, `es`, `ja`), HP.
- Variante, somente quando o catálogo indicar uma única variante inequívoca entre Normal/Holo/Reverse Holo.

Nunca são inferidos automaticamente: condição, preço, lance inicial, incremento, ARREMATE.

## Prioridade da edição manual

Cada campo reconhecível mantém um sinal de edição manual. Assim que o usuário altera Nome, Coleção, Número, Idioma ou Variante, reconhecimentos automáticos posteriores não sobrescrevem esse campo. Escolher explicitamente um candidato também é uma decisão manual — e grava a foto como exemplo confirmado na memória do serviço local (ground truth para futuros reconhecimentos).

## Benchmarks

Reprodutíveis via `recognition/scripts/benchmark.py` com fixtures sintéticas geradas de scans oficiais (`recognition/scripts/make_fixtures.py`), separadas em níveis normal/hard (perspectiva + fundo de cena + glare/blur/low-light empilhados).

Resultados históricos (fixture sintética pt-BR, n=106):

| Método | Top-1 | Top-5 | Falso alta conf. | Latência |
|---|---|---|---|---|
| OCR-gatekeeper (arquitetura antiga, emulada) | 3,8% | 7,5% | 25,5% | ~5031 ms |
| Rota visual DINOv3-S | 92,5% | 95,3% | 0,94% | ~257 ms |
| Híbrido DINOv3-S + SIFT + OCR (baseline desta iteração) | 93,4% | 95,3% | 0,00% | ~4379 ms (CPU 2 núcleos) |

O bake-off de embeddings (mini-índice adversarial: cartas-verdade + confusores do índice completo + 500 distratores) definiu o backbone atual: SigLIP2-base-384 com query multi-view (raw + gamma-auto) recuperou rank-1 em todos os casos hard que o DINOv3-S@224 perdia (ranks 286/12/118/45/49 → 1/1/1/1/1). Os números finais do pipeline SigLIP2 estão em `recognition/README.md`.

Fotos reais do acervo do usuário devem entrar em `recognition/data/fixtures-real/` com `ground-truth.json` no mesmo formato — o benchmark aceita `--fixtures data/fixtures-real` para medir separadamente sintético × real.
