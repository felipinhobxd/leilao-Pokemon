# 04_API — API Next.js (app/api)

> Área: API HTTP do painel
> Escopo: Rotas, contratos, autenticação, idempotência
> Última atualização: 2026-09-24
> Fonte principal: `app/api/**/route.ts`, `lib/backend.ts`, `lib/purge.ts`, `lib/card-recognition-token.mjs`, `lib/card-catalog.ts`, `lib/rate-limit.ts`, `lib/auction-draft.ts`

## Padrão comum (confirmado em todas as rotas)

- `export const runtime = "nodejs"`.
- Auth: `authorize(request, write?)` (`lib/backend.ts`) — JWT Supabase do header `Authorization: Bearer`, validado contra `admin_profiles` (role admin/operator, `active`). Falha → `failure(error)` com status/PT-BR.
- Escrita transacional: sempre via `db.rpc(...)` com service_role (`lib/supabase-server.ts`).
- Nenhuma lógica de negócio em JS: as routes validam formato e chamam RPCs.

## Rotas

### `POST /api/auctions/new` — criar leilão único (wizard `/auctions/new/single`)
- Body: `eventId`, `card{name, card_number, variant, condition, language, image_url, collection}`, `auction{lot_number?, starting_price, bid_increment, buyout_price?, option_count?, scheduled_at, scheduled_end_at?, group_id, pricing_mode: increment|custom, custom_values?, custom_buyout_last?}`.
- Valores custom: `parseCustomValues` + `buildCustomValuesPlan` (`lib/auction-wizard.ts`) — server-side deriva `starting_price/bid_increment/buyout_price` e as `poll_options`.
- Ghost-lot guard: `validateCardAgainstCatalog` (`lib/card-catalog.ts`) consulta o serviço local `/catalog/exists` com token; sem serviço → cria sem validar + log; `RECOGNITION_STRICT_CATALOG=1` bloqueia.
- Idempotência: `eventId` (RPC). Erros: 400 validações, 409 `lot_number_in_use`/catálogo, 503 strict.
- Suporte: `GET /api/auctions/new/status` — status de publicação pós-criação (usado pelo wizard único para acompanhar o envio).

### `POST /api/auctions/batch` — fila em lote (wizard `/auctions/new`)
- Body: `eventId`, `queue{group_id, starts_at, interval_seconds}`, `items[1..100]{card, auction}` — cada item aceita `pricing_mode/custom_values/custom_buyout_last` (espelha a rota única; `poll_options` gravadas por item).
- **Itens de brinde (2026-09-24)**: item `giveaway{options[2..12]}` (carta marcada como Brinde) — NÃO vira leilão: o RPC cria enquete de brinde (foto + opções livres) na posição do lote; validação própria (nome obrigatório — é o título, foto HTTPS, opções 2..12 ≤100 chars); lote/duração/valores não se aplicam.
- Valida: lotes únicos e >0, duração 1s–604800s, intervalo 1–86400s.
- Cria TUDO via `create_auction_publish_queue`; erros mapeados (409 lote duplicado/grupo indisponível/evento conflitante).

### `/api/auctions/drafts` — rascunhos do wizard em lote (2026-09-24)
- `GET` sem parâmetros → lista do operador (`id, title, updated_at`, máx 50, payloads ficam no banco); `GET ?draftId=` → rascunho completo (payload incluso). Filtro `created_by = user.id`.
- `POST` → salvar/atualizar: body `{draftId (uuid client-generated), title 1..120, state}`; `state` validado em JS + RPC (objeto, cards 1..200, ≤512KB). Escreve via RPC `upsert_auction_draft` (idempotente por PK; MESMO input duas vezes = mesma linha).
- `DELETE ?draftId=` → descartar (RPC `delete_auction_draft`, idempotente por estado). O wizard chama automaticamente após publicar a fila (rascunho virou leilão).
- Erros: 400 validações, 404 `draft_not_found` (não existe OU é de outro admin — existência nunca vaza), 409 `draft_save_conflict` (duas abas salvaram juntas).

### `/api/auctions/queue` — fila em execução (tela pós-publicação do wizard em lote)
- Métodos conforme implementação (pause/resume/cancel/status/consultas de itens) — o wizard usa para **Pausar/Continuar/Cancelar** a fila e acompanhar `summary` (total/publicados/falhos/pendentes/próximo). Estado `paused` é persistente: retomar continua exatamente do próximo dispatch pendente, sem duplicação (claim idempotente por dispatch).
- **Brindes na fila (2026-09-24)**: o `items` agora traz TAMBÉM as enquetes de brinde da fila (`poll`, por `queue_position`, entre os leilões); o `summary` conta brindes em publicados/pendentes/total.

### `GET /api/dashboard` — painel ao vivo
- `?scope=operations` → só bot/grupo/dispatches; sem scope → `read_dashboard_snapshot` + operações.
- Janela de dispatches: **30 dias** (`windowStart`), counts por status via PostgREST `head:true`.

### `GET /api/export` — planilha Excel (ExcelJS)
- Fonte: `snapshot(db)` (`read_auction_snapshot`).
- Abas: **Vendas** (com coluna **Avisos (global)** e linha **TOTAL** com fórmula `=SUM`), **Resumo**, **Alterações de valores** (histórico com anterior/novo/diferença/avisos/horário/marca de redução), + abas brutas (Cartas, Leilões, Lances, Compras, Pagamentos, Entregas, Advertências, Alterações (bruto), Avisos globais (bruto), Auditoria).
- Cabeçalho estilizado, autofilter, datas em `dd/mm/yyyy hh:mm:ss` (Brasília, `lib/brasilia-time.ts`), moeda `"R$" #,##0.00`.

### `/api/cards/image` + `/api/cards/image/authorize` — upload de fotos
- `authorize` emite URL assinada do Supabase Storage com **rate limit 50 req/min/usuário** (`lib/rate-limit.ts`; Redis quando `REDIS_URL`, senão in-memory).
- Upload batched e incremental: `lib/card-image.ts` (`uploadCardImageBatch` — dedup no storage, preserva o que já subiu).

### `/api/card-recognition/*` — ponte com o serviço local
- `GET /api/card-recognition/token` — minta token HMAC (5 min default, máx 15) com `issueRecognitionServiceToken` (`lib/card-recognition-token.mjs`); exige sessão admin; segredo `RECOGNITION_SERVICE_SHARED_SECRET` (server-only).
- `GET /api/card-recognition/scan` e `POST /api/card-recognition/memory` — proxies autenticados para os endpoints equivalentes do serviço local.

### `POST /api/commands` — enfileirar comando para o bot
- Escreve em `whatsapp_bot_commands` (o supervisor faz poll a cada 3s). Usado pela central WhatsApp (reconectar, logout, sincronizar grupos etc.).

### `POST /api/quick-polls` — brindes: enquete rápida (2026-09-24)
- Body: `eventId`, `groupId` (ativo), `title` 1..200, `options` 2..12 (≤100 chars cada), `scheduledAt` (default agora; passado >2min → 400). Idempotência leve: `external_event_id = quick-poll:{eventId}` (mesmo eventId devolve a enquete existente).
- GET → recentes (20, agendados + enviados). Consumidor: `/auctions/brinde` (formulário movido da Central WhatsApp — decisão do operador).

### `/api/whatsapp/*`
- `bootstrap` (estado inicial da central), `bot` (status do worker/QR/session), `groups` (lista de grupos; `is_default`), `schedules` (consulta de agendamentos). Leitura via service_role; QR NUNCA vai para não-operador.

### `POST /api/admin/purge` — "Excluir TUDO"
- Frases em 2 passos (`lib/purge.ts`: `excluir tudo` → `quero excluir mesmo`), revalidadas na API e no RPC; erros traduzidos (503 função ausente com instrução de aplicar migration).

### `GET /api/health` — healthcheck simples do site.

## Idempotência e erros — resumo

| Rota | Idempotência | Erros típicos |
|---|---|---|
| auctions/new | `eventId` no RPC | 400/409/503 |
| auctions/batch | `eventId` no RPC | 400/409 |
| auctions/drafts | upsert por PK (draftId client-generated) | 400/404/409 |
| commands | comando com id próprio (claim único) | 409 conflito |
| card-recognition/token | — (mint por sessão, cache 60s no cliente) | 401, 503 segredo ausente |
| admin/purge | frase-trava | 400/503 |

## Relação com consumidores

- Wizard em lote: `bulk-wizard.tsx` chama `auctions/batch` + `cards/image/authorize` + `auctions/queue`.
- Wizard único: `wizard.tsx` chama `auctions/new` + `auctions/new/status`.
- Dashboard: `dashboard/route`.
- Central WhatsApp: `whatsapp/*` + `commands`.
- Bot: **NÃO chama a API HTTP** — fala direto com o Supabase (RPCs/tables).
