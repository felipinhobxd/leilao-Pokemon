# 09_TESTS_AND_VALIDATION — Testes e validação

> Área: Testes
> Escopo: Suítes, comandos, cobertura, lacunas
$12026-10-07
> Fonte principal: `package.json`, `bot/package.json`, `.github/workflows/ci.yml`, `tests/**`, `bot/*.test.mjs`

## Comandos oficiais

```bash
# Site (raiz)
npm ci
npm run typecheck      # tsc --noEmit
npm test               # node --test tests/*.test.mjs  (71 testes)
node --test bot/*.test.mjs    # testes do bot (payment-reminder, announce-sticker, warning-notify, poll-votes, queue-worker...)
npm run doctor         # check-up pré-leilão: migrations, RPCs, bot, backup, figurinha
npm run build          # next build

# Bot
npm --prefix bot ci
npm --prefix bot run check   # node --check em todos os .mjs + patch-baileys --check + node --test poll-votes/queue-worker

# Smoke autenticado (contra build local rodando)
node tests/smoke.mjs
```

## Suítes por grupo

### 1. Site/lib — `node --test tests/*.test.mjs` (71)
- O que valida: formatos de leilão (`auction-format.test.mjs` — inclui valores personalizados), rascunhos do wizard (`auction-draft.test.mjs` — serialize/restore, guards de tamanho/contagem, clamp de etapa, compatibilidade com rascunhos da era do reconhecimento), rate limit, purge, comandos, dispatch-id, identidades de enquete, store de votos, grupos, contraste de UI (WCAG), tempo de Brasília, status WhatsApp, lifecycle do start-all (`start-all.test.mjs`), card-image.
- Riscos cobertos: anti-congelamento de UI, idempotência de formatos, round-trip estável do rascunho (restore∘build = identidade).
- Lacunas: sem testes de rotas HTTP reais (só `smoke.mjs` pós-build); export Excel sem teste unitário (validado por build + revisão).

### 2. Banco — SQL executado no CI (Postgres 17 real)
- Como: `ci.yml` aplica `tests/bootstrap.sql` + `supabase/schema.sql` + `supabase/whatsapp_bridge.sql` + **todas as migrations em ordem** + `tests/*.sql` (participant-identities, auction, auction-warnings, warning-notice, quick-polls-reminders, auction-drafts, giveaway-queue, edit-queue-item, delete-auction, auction-wizard, auction-queue, auction-queue-runtime, auction-queue-scale, dashboard-snapshot, cleanup-retention, **participants-panel, withdraw-rebid-warning**) via `psql -v ON_ERROR_STOP`.
- O que valida: schema aplicável, RPCs, wizard, fila, runtime/escala da fila, snapshots, avisos globais, brindes/lembretes, rascunhos (`auction-drafts.sql`: upsert idempotente, guards, propriedade, delete idempotente, backup, **primeira cobertura SQL do purge**, RLS), retenção da limpeza 12h (`cleanup-retention.sql`), **comandos de participante + snapshot stats** (`participants-panel.sql`: suspensão com prazo/indefinida, auto-expira, banido não suspenso, reativação, idempotência/event_id_conflict, participant_warning_stats, contrato da chave participants) e **redução via retirada+re-oferta** (`withdraw-rebid-warning.sql`: log change_kind, aviso só na redução, ciclo de 3 misto com DM no payload do bot, replay sem duplicar, change_kind no snapshot).
- `tests/concurrency.py` (Python): buyouts concorrentes e eventos duplicados.
- ⚠️ Localmente exige Postgres + psql; a validação local usual é confiar no CI.

### 3. Bot — `node --test bot/*.test.mjs` (40)
- poll-votes (decriptografia com pares LID/telefone), queue-worker (claim/lock/heartbeat/retry), poll-identities, poll-store, group-participants, bot-reconnect, warning-notify (formatador BRL/nbsp, entrega, retry parcial sem duplicar, sem socket).
- Lacunas: sem teste de sessão real Baileys (impossível offline), sem teste do restart noturno (lógica fina, revisada). A limpeza 12h é coberta por `tests/cleanup-retention.sql` (janela padrão dos dois lados + granularidade em horas).

### 4. CI/CD (`.github/workflows`)
- `ci.yml` (push/PR main): job `validate` (Postgres + SQL + concorrência + typecheck + testes + bot check + PS1 do serviço Windows + build + smoke), `windows-startup` (start-all test).

## Validação manual estabelecida (histórico do projeto)

- Smoke de avisos (pendente — lista do operador): pausar/retomar fila, subir/igualar/reduzir valores, 3 reduções = DM aos admins, sem duplicação.

## O que NÃO tem cobertura (registrar ao planejar)

- Migrações novas sem suíte SQL dedicada (padrão atual: aplicação no CI + revisão cuidadosa).
- Fluxo completo WhatsApp (só com grupos reais).
- Export Excel: conferência visual (TOTAL, aba Alterações) pós-deploy.
