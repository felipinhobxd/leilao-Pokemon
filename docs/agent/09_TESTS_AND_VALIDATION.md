# 09_TESTS_AND_VALIDATION — Testes e validação

> Área: Testes
> Escopo: Suítes, comandos, cobertura, lacunas
> Última atualização: 2026-09-23
> Fonte principal: `package.json`, `bot/package.json`, `.github/workflows/ci.yml`, `tests/**`, `bot/*.test.mjs`, `recognition/tests/**`, `benchmarks/`, `docs/card-recognition.md`

## Comandos oficiais

```bash
# Site (raiz)
npm ci
npm run typecheck      # tsc --noEmit
npm test               # node --test tests/*.test.mjs  (155 testes)
node --test bot/*.test.mjs    # 31 testes do bot (payment-reminder, announce-sticker, warning-notify, poll-votes, queue-worker...)
npm run doctor         # check-up pré-leilão: migrations, bot, reconhecimento, backup, figurinha
npm run build           # next build

# Bot
npm --prefix bot ci
npm --prefix bot run check   # node --check em todos os .mjs + patch-baileys --check + node --test poll-votes/queue-worker
node --test bot/*.test.mjs    # suíte completa do bot (20 testes: poll-votes, queue-worker, poll-identities, poll-store, group-participants, warning-notify, bot-reconnect...)

# Reconhecimento (Windows, a partir de recognition/)
.venv\Scripts\python.exe -m unittest discover -s tests   # 248 testes (leves, sem modelos)
# benchmarks pesados (modelos 1,6 GB + catálogo): scripts/benchmark.py etc — manuais, ver recognition/README.md

# Smoke autenticado (contra build local rodando)
node tests/smoke.mjs
```

## Suítes por grupo

### 1. Site/lib — `node --test tests/*.test.mjs` (155)
- O que valida: formatos de leilão (`auction-format.test.mjs` — inclui valores personalizados), contrato do serviço de reconhecimento (`card-recognition-*.test.mjs` — 10 arquivos: contract, evidence, fusion, local, runtime, stability, toggle, v10), rate limit, purge, comandos, dispatch-id, identidades de enquete, store de votos, grupos, contraste de UI (WCAG), tempo de Brasília, status WhatsApp, lifecycle do start-all (`start-all.test.mjs`), card-image.
- Riscos cobertos: contratos TS↔Python, anti-congelamento de UI, idempotência de formatos.
- Lacunas: sem testes de rotas HTTP reais (só `smoke.mjs` pós-build); export Excel sem teste unitário (validado por build + revisão).

### 2. Banco — SQL executado no CI (Postgres 17 real)
- Como: `ci.yml` aplica `tests/bootstrap.sql` + `supabase/schema.sql` + `supabase/whatsapp_bridge.sql` + **todas as migrations em ordem** + `tests/*.sql` (participant-identities, auction, auction-wizard, auction-queue, auction-queue-runtime, auction-queue-scale, dashboard-snapshot) via `psql -v ON_ERROR_STOP`.
- O que valida: schema aplicável, RPCs, wizard, fila, runtime/escala da fila, snapshots.
- `tests/concurrency.py` (Python): buyouts concorrentes e eventos duplicados.
- ⚠️ Localmente exige Postgres + psql; a validação local usual é confiar no CI. NÃO existe suíte SQL da migration de avisos (20260923093000) — **lacuna real** (ver 11_PENDING_WORK).

### 3. Bot — `node --test bot/*.test.mjs` (20)
- poll-votes (decriptografia com pares LID/telefone), queue-worker (claim/lock/heartbeat/retry), poll-identities, poll-store, group-participants, bot-reconnect, warning-notify (formatador BRL/nbsp, entrega, retry parcial sem duplicar, sem socket).
- Lacunas: sem teste de sessão real Baileys (impossível offline), sem teste do restart noturno/limpeza 30d (lógica fina, revisada).

### 4. Reconhecimento — Python unittest (252; +3 release, +1 density gate real-foto; rodar: ecognition\\.venv\\Scripts\\python.exe -m unittest discover -s tests a partir de recognition/)
- `test_units.py` (normalização, OCR hints, linguagem, auth HMAC, loader de .env), `test_postmerge.py` (gêmeas de idioma, denominador/corroboração/misread, memória, Devir pré-2011), `test_stability_round.py`, `test_perf_round.py`, `test_catalog_round.py` (41: sync incremental, resume, gaps, reconcile, find_catalog_card).
- Sem modelos pesados por design (CI leve); E2E com modelos é manual (`scripts/benchmark.py`, `stress_service.py`).
- Lacunas: holdout cego de fotos reais (reconhecimento/README pede 30–100 fotos — nunca montado).

### 5. CI/CD (`.github/workflows`)
- `ci.yml` (push/PR main): job `validate` (Postgres + SQL + concorrência + typecheck + testes + bot check + PS1 do serviço Windows + build + smoke), `recognition-python` (compileall + unittest, Python 3.13), `windows-startup` (start-all + parse PS1 do recognition).
- `card-recognition-index.yml` / `card-recognition-local-tools.yml`: workflows de índice/ferramentas locais (uso rotineiro não confirmado — precisa de investigação).

## Validação manual estabelecida (histórico do projeto)

- E2E reconhecimento: subir serviço → `/health` `ready=true` → mintar token (`lib/card-recognition-token.mjs`) → `POST /recognize` com foto real → `IDENTIFICADO`.
- Rodada de cartas reais do operador: pasta de fotos (ex.: `Downloads/poke_*`) → script de benchmark local por scan → conferir identidade 100%.
- Smoke de avisos (pendente — lista do operador): pausar/retomar fila, subir/igualar/reduzir valores, 3 reduções = DM aos admins, sem duplicação.

## O que NÃO tem cobertura (registrar ao planejar)

- Migrações novas sem suíte SQL dedicada (padrão atual: aplicação no CI + revisão cuidadosa).
- Fluxo completo WhatsApp (só com grupos reais).
- Export Excel: conferência visual (TOTAL, aba Alterações) pós-deploy.
- Vercel produção: `RECOGNITION_SERVICE_SHARED_SECRET` como env server-only (aqui confirmado em `.env.local` local; Vercel depende do operador).
