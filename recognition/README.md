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
- **OCR**: PP-OCRv6 medium (det+rec) por regiões com confiança por leitura; número lê o strip inferior completo (layouts variam — ex.: `091/132` no canto inferior esquerdo em PT-BR).
- **Reprints**: quando a arte é praticamente idêntica e número/set/rodapé estão ilegíveis, o sistema entrega o nome correto + candidatos e decide `PROVÁVEL`/`REVISAR` — nunca inventa a impressão exata.
- **Memória**: apenas confirmação explícita do usuário cria exemplares (ground truth); predições nunca são auto-salvas.

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
| **Híbrido siglip2+SIFT+OCR (atual)** | **96,2%** | **98,1%** | **0,00%** | ~7080 ms |

Híbrido atual (n=106 fixtures sintéticas, índice pt-BR completo com 12.588 cartas, CPU 2 núcleos do sandbox): Top-3 = 97,2%; name 99,1%; set 96,2%; idioma 100%; identified 84,0%; p95 8679 ms. Em máquina Windows com GPU (DirectML/CUDA) a latência cai fortemente — no sandbox os 4 views SigLIP2 rodam em CPU limitada.

Falhas Top-1 restantes (4/106), todas com decisão honesta:
- 2 reprints de arte idêntica (`swsh4.5-30` vs `swsh1-64` Frosmoth; `sv07-107` vs `sv08.5-070` Archaludon) → `REVISAR` com o par de candidatos certo (margem 0,3–0,8 pts). Sem leitura de número/set, força de evidência não existe — não se inventa exact match.
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

## Instalação (Windows)

```powershell
npm run recognition:install   # venv + deps (GPU NVIDIA detectada automaticamente) + modelos + catálogo + índice
npm run recognition:local     # serviço em 127.0.0.1:8765
npm run start                 # site + bot + este serviço (opcional; sem ele o site usa o pipeline do navegador)
```

Equivalente direto: `recognition\install-windows.ps1` e `recognition\run-local.ps1`.

- Modelos (ONNX, de Hugging Face, via `scripts/download_models.py`): **core** = SigLIP2-base-384 + PP-OCRv6 medium (~1.6 GB, instalação padrão); **extras** (`--extras`) = DINOv3-S (fallback leve) + ALIKED/LightGlue (matcher aprendido — o SIFT default já vem com o OpenCV); `--all` soma os backbones de bake-off.
- Catálogo: TCGdex → SQLite local (todos os idiomas); scans oficiais `high.webp` em cache local — a instalação baixa pt-BR (≈ 12.6k) + en (≈ 19.5k); es/ja ficam apenas nos metadados.
- Índice: `build_index.py --model siglip2-base-384 --batch 8` (batch maior causa OOM; valor validado) com checkpoint incremental — pt-BR primeiro, en em seguida; interromper/retomar sem perder trabalho.
- GPUs: CUDA/DirectML detectadas automaticamente pelo ONNX Runtime.

## Estrutura

```
recognition/
├── recognition_server.py     # FastAPI: /health /recognize /memory /reload-index
├── recognizer/
│   ├── normalize.py          # detecção/retificação + gamma_auto/photometric_variants
│   ├── embed.py              # ONNX embeddings (SigLIP2, DINOv2/3) com interface comum
│   ├── features.py           # SIFT/AKAZE/ALIKED+LightGlue + RANSAC
│   ├── ocr.py                # PP-OCRv6 por regiões
│   ├── hints.py              # hints textuais + overrides de regressão
│   ├── catalog.py            # TCGdex → SQLite + cache de scans
│   ├── store.py              # consultas de catálogo/candidatos textuais
│   ├── memory.py             # memória confirmada (apenas ground truth do usuário)
│   ├── pipeline.py           # rotas A/B + fusão + decisão honesta
│   └── config.py             # caminhos, calibração por modelo
├── scripts/                  # build/download/benchmark/bake-off/calibração
├── tests/test_units.py       # testes rápidos sem modelos
└── data/                     # (local, gitignored) catálogo, scans, índices, fixtures
```

## Privacidade

Tudo roda localmente. Nenhuma API paga, nenhuma imagem enviada a serviços externos. O serviço liga apenas em `127.0.0.1` e aceita CORS apenas das origens localhost do site.
