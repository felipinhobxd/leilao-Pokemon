# 01_PROJECT_CONTEXT — Contexto geral do sistema

> Área: Projeto inteiro
> Escopo: Visão geral, objetivo do produto, componentes, ambientes
> Última atualização: 2026-09-23
> Fonte principal: README.md, package.json, bot/package.json, recognition/README.md, código das sessões de trabalho até `6b9e8a6e`

## O que o projeto faz

Sistema de **leilões de cartas Pokémon via WhatsApp**: um operador cadastra cartas (com fotos) num painel web, o sistema agenda e publica automaticamente nos grupos de WhatsApp — **foto da carta primeiro, enquete nativa de lances 5 segundos depois** — e os participantes dão lances clicando nas opções da enquete. O bot contabiliza lances, resolve empates, aplica ARREMATE (buyout), fecha lotes, registra vendas e exporta planilha Excel para controle financeiro. A IA local de reconhecimento identifica a carta da foto durante o cadastro.

## Objetivo do produto

Operar leilões recorrentes em grupos de WhatsApp com o mínimo de trabalho manual: reconhecimento automático das cartas, publicação agendada em fila, arremates auditáveis e planilha pronta para anotação/gestão.

## Componentes principais

| Componente | Onde | Tecnologia | Roda em |
|---|---|---|---|
| Painel + API | `app/`, `lib/` | Next.js 16 (App Router), React 19, TypeScript | Vercel (produção) / localhost (dev) |
| Fonte da verdade | `supabase/` (schema + migrations) | Supabase/PostgreSQL + RPCs | Supabase cloud |
| Bot WhatsApp | `bot/` | Node 24 + Baileys 7.0.0-rc14 | **Máquina Windows do operador** (não roda na Vercel) |
| Reconhecimento | `recognition/` | Python 3.13 + FastAPI + ONNX (SigLIP2, PP-OCRv6) + OpenCV | Máquina do operador, `127.0.0.1:8765` |
| Catálogo de cartas | cache local `recognition/data/card-index/` (SQLite + scans) | TCGdex + pokemon-tcg-data | Local (~5,6 GB scans, 57.148 cartas) |

## Como as partes se comunicam

- **Painel → Supabase**: API routes (`app/api/**`) chamam RPCs via client service_role (`lib/supabase-server.ts`). Nenhuma lógica de negócio em JS: **toda escrita crítica passa por RPCs transacionais** (ex.: `process_auction_command`, `create_auction_publish_queue`).
- **Painel ↔ Serviço de reconhecimento**: HTTP `127.0.0.1:8765` com token HMAC curto emitido por `/api/card-recognition/token` (segredo compartilhado `RECOGNITION_SERVICE_SHARED_SECRET` nos dois lados). Fallback automático para pipeline do navegador quando o serviço está offline/não pronto (`lib/card-recognition-local.ts`).
- **Bot → Supabase**: o bot é um *poller*: claim de dispatches (`claim_whatsapp_dispatch`), gravação de votos (`process_auction_command`), heartbeat em `whatsapp_bot_workers`.
- **WhatsApp → Bot**: eventos Baileys (mensagens, atualizações de enquete) → decriptografia de votos (`bot/poll-votes.mjs`, identidades LID/telefone em `bot/poll-identities.mjs`) → comandos idempotentes no banco.
- **Supabase → Painel**: leitura via snapshot RPCs (`read_dashboard_snapshot`, `read_auction_snapshot`).

## Fluxo principal (visão de alto nível)

1. Operador faz upload das fotos em `/auctions/new` (wizard em lote) → IA identifica cartas → preenchimento assistido.
2. Operador define valores (automático por incremento **ou** personalizados), duração por carta, grupo e agendamento.
3. `POST /api/auctions/batch` → RPC `create_auction_publish_queue` → fila de dispatches com posições ordenadas.
4. Bot local clama cada dispatch na hora certa → envia **imagem** e **5s depois a enquete** no grupo.
5. Participantes votam → eventos de enquete chegam ao bot → `process_auction_command` registra lances (com guarda de incremento mínimo e idempotência por event-id).
6. Fim do prazo → `AUCTION_FINALIZE` coroa vencedor (tie-break por horário REAL do voto, `whatsapp_event_at`) → `purchases`/`deliveries` criadas.
7. Redução de valor por voto = **aviso global** por usuário; 3 avisos → DM automática aos administradores.
8. Exportação Excel (`/api/export`) com vendas, TOTAL, alterações de valores e avisos globais.

## Dependências externas

- Supabase (DB, Auth, Storage) — projeto próprio do operador;
- TCGdex API + pokemon-tcg-data (catálogo de cartas; Limitless opcional via `LIMITLESS_API_KEY`);
- Hugging Face (download dos modelos ONNX, `scripts/download_models.py`);
- WhatsApp (via Baileys — **não oficial**, risco de ban inerente);
- Vercel (hosting do painel).

## Ambiente de execução / variáveis críticas

- **Raiz `.env.local`**: chaves Supabase (`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SERVICE_ROLE_KEY`) + `RECOGNITION_SERVICE_SHARED_SECRET` (mesmo valor do `recognition/.env`).
- **`bot/.env`**: `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `BOT_ADMIN_USER_ID`, `BOT_ADMIN_WA_JIDS` (DMs de aviso; default: 554197285978, 5519989759121), `BOT_CLEANUP_DAYS` (30), `BOT_NIGHT_RESTART_HOUR` (4).
- **`recognition/.env`** (gitignored): `RECOGNITION_SERVICE_SHARED_SECRET` (≥32 chars), `RECOGNITION_ALLOWED_ORIGINS`, `RECOGNITION_SCAN_CACHE_MB=150`, `RECOGNITION_SIFT_CACHE_MB=48`, `RECOGNITION_IDLE_UNLOAD_MINUTES=10`. Carregado pelo próprio Python (`recognizer/config.py::load_local_env`).
- Máquina-alvo do operador: Windows, Node 24, Python venv em `recognition/.venv`, GPU AMD RX 570 4 GB (DirectML).

## Fonte da verdade dos dados

**Supabase/PostgreSQL** — confirmado no README e no código: nenhuma escrita de negócio acontece fora de RPCs; o bot e o painel são ambos clientes. O cache de reconhecimento (SQLite + scans) é dado derivado, reconstrutível.

## Decisões arquiteturais já existentes (confirmadas no código)

1. Toda lógica transacional crítica vive em **RPCs PL/pgSQL** (`process_auction_command`), com idempotência via `processed_commands` (external_event_id) + advisory lock + guard `event_id_conflict`.
2. **Audição append-only**: trigger `immutable_audit` bloqueia UPDATE/DELETE em `auction_events`; exceções controladas (purge/limpeza) levantam e restauram o trigger na mesma transação.
3. Reconhecimento é **serviço local opcional**: o site nunca depende dele para funcionar (fallback no navegador).
4. Bot é **supervisor + filho** (`bot/service.mjs` + `bot/index.mjs`), com trava de sessão única por porta derivada de hash (`bot/session-guard.mjs`).
5. Enquete do WhatsApp é a fonte dos lances: votos são decriptografados (poll encryption) e convertidos em comandos idempotentes.
6. Valores personalizados de enquete viram `poll_options` persistidas no leilão (o bot publica o que está no banco).
7. Índice de reconhecimento construído **forçando CPU** no Windows (`scripts/recognition-shared.mjs`) — DirectML produz NaN intermitente no build em lote.
8. Node do bot roda com `--max-old-space-size=384` + restart noturno (RAM era o gargalo do PC do operador).

## Estado atual (2026-09-23)

- 100% dos fluxos principais funcionais e testados (CI verde; suítes: 155 testes raiz, 20 bot, 248 python).
- Migration de avisos globais `20260923093000` versionada, **aguardando aplicação manual no Supabase** (fluxo padrão do projeto).
- Backlog real do operador em `11_PENDING_WORK.md`.
